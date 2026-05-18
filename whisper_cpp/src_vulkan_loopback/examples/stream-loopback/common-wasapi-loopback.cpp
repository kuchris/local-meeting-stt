#include "common-wasapi-loopback.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <audioclient.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys_devpkey.h>

namespace {

struct com_init {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    ~com_init() {
        if (SUCCEEDED(hr)) {
            CoUninitialize();
        }
    }
};

template <typename T>
void release(T *& ptr) {
    if (ptr) {
        ptr->Release();
        ptr = nullptr;
    }
}

std::wstring device_name(IMMDevice * device) {
    IPropertyStore * props = nullptr;
    PROPVARIANT name;
    PropVariantInit(&name);

    std::wstring result = L"(unknown)";
    if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, &props)) &&
        SUCCEEDED(props->GetValue(PKEY_Device_FriendlyName, &name)) &&
        name.vt == VT_LPWSTR && name.pwszVal) {
        result = name.pwszVal;
    }

    PropVariantClear(&name);
    release(props);
    return result;
}

std::string narrow(const std::wstring & text) {
    if (text.empty()) {
        return "";
    }
    int size = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string result(((size > 0) ? (size - 1) : 0), '\0');
    if (size > 1) {
        std::vector<char> buffer(size);
        WideCharToMultiByte(CP_UTF8, 0, text.c_str(), -1, buffer.data(), size, nullptr, nullptr);
        result.assign(buffer.data());
    }
    return result;
}

IMMDevice * select_render_device(IMMDeviceEnumerator * enumerator, int render_id) {
    IMMDevice * device = nullptr;

    if (render_id < 0) {
        if (FAILED(enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device))) {
            return nullptr;
        }
        fprintf(stderr, "loopback: using default render device: %s\n", narrow(device_name(device)).c_str());
        return device;
    }

    IMMDeviceCollection * collection = nullptr;
    if (FAILED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &collection))) {
        return nullptr;
    }

    UINT count = 0;
    collection->GetCount(&count);
    if (render_id >= 0 && static_cast<UINT>(render_id) < count) {
        collection->Item(static_cast<UINT>(render_id), &device);
    }
    release(collection);
    return device;
}

void print_render_devices(IMMDeviceEnumerator * enumerator) {
    IMMDeviceCollection * collection = nullptr;
    if (FAILED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &collection))) {
        fprintf(stderr, "loopback: failed to enumerate render devices\n");
        return;
    }

    UINT count = 0;
    collection->GetCount(&count);
    fprintf(stderr, "loopback: found %u render devices:\n", count);
    for (UINT i = 0; i < count; ++i) {
        IMMDevice * device = nullptr;
        if (SUCCEEDED(collection->Item(i, &device))) {
            fprintf(stderr, "loopback:    - Render device #%u: '%s'\n", i, narrow(device_name(device)).c_str());
        }
        release(device);
    }
    release(collection);
}

float sample_to_float(const BYTE * data, WORD bits_per_sample, WAVEFORMATEX * format, UINT32 frame, WORD channel) {
    const BYTE * frame_data = data + frame * format->nBlockAlign + channel * (bits_per_sample / 8);
    if (format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ||
        (format->wFormatTag == WAVE_FORMAT_EXTENSIBLE &&
         reinterpret_cast<WAVEFORMATEXTENSIBLE *>(format)->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)) {
        return *reinterpret_cast<const float *>(frame_data);
    }
    if (bits_per_sample == 16) {
        return static_cast<float>(*reinterpret_cast<const int16_t *>(frame_data)) / 32768.0f;
    }
    if (bits_per_sample == 24) {
        int32_t value = frame_data[0] | (frame_data[1] << 8) | (frame_data[2] << 16);
        if (value & 0x800000) {
            value |= ~0xFFFFFF;
        }
        return static_cast<float>(value) / 8388608.0f;
    }
    if (bits_per_sample == 32) {
        return static_cast<float>(*reinterpret_cast<const int32_t *>(frame_data)) / 2147483648.0f;
    }
    return 0.0f;
}

std::vector<float> resample_linear(const std::vector<float> & input, uint32_t input_rate, uint32_t output_rate) {
    if (input.empty() || input_rate == 0 || output_rate == 0 || input_rate == output_rate) {
        return input;
    }

    const double ratio = static_cast<double>(input_rate) / static_cast<double>(output_rate);
    const size_t output_size = static_cast<size_t>(input.size() / ratio);
    std::vector<float> output(output_size);
    for (size_t i = 0; i < output_size; ++i) {
        const double source = i * ratio;
        const size_t left = static_cast<size_t>(source);
        const size_t right = (left + 1 < input.size()) ? left + 1 : left;
        const float frac = static_cast<float>(source - left);
        output[i] = input[left] * (1.0f - frac) + input[right] * frac;
    }
    return output;
}

}

audio_async::audio_async(int len_ms) : m_len_ms(len_ms) {}

audio_async::~audio_async() {
    m_stop = true;
    if (m_thread.joinable()) {
        m_thread.join();
    }
}

bool audio_async::init(int render_id, int sample_rate) {
    com_init com;
    if (FAILED(com.hr)) {
        fprintf(stderr, "loopback: CoInitializeEx failed\n");
        return false;
    }

    IMMDeviceEnumerator * enumerator = nullptr;
    HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
    if (FAILED(hr)) {
        fprintf(stderr, "loopback: CoCreateInstance(MMDeviceEnumerator) failed\n");
        return false;
    }

    print_render_devices(enumerator);
    IMMDevice * device = select_render_device(enumerator, render_id);
    if (!device) {
        fprintf(stderr, "loopback: failed to select render device %d\n", render_id);
        release(enumerator);
        return false;
    }
    fprintf(stderr, "loopback: selected render device: %s\n", narrow(device_name(device)).c_str());

    release(device);
    release(enumerator);

    m_render_id = render_id;
    m_sample_rate = sample_rate;
    m_audio.resize((m_sample_rate * m_len_ms) / 1000);
    return true;
}

bool audio_async::resume() {
    if (m_running) {
        return false;
    }
    m_stop = false;
    m_running = true;
    m_thread = std::thread(&audio_async::capture_loop, this);
    return true;
}

bool audio_async::pause() {
    if (!m_running) {
        return false;
    }
    m_stop = true;
    if (m_thread.joinable()) {
        m_thread.join();
    }
    m_running = false;
    return true;
}

bool audio_async::clear() {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_audio_pos = 0;
    m_audio_len = 0;
    return true;
}

bool audio_async::append_samples(const float * samples, size_t n_samples) {
    if (n_samples > m_audio.size()) {
        samples += n_samples - m_audio.size();
        n_samples = m_audio.size();
    }

    std::lock_guard<std::mutex> lock(m_mutex);
    if (m_audio_pos + n_samples > m_audio.size()) {
        const size_t n0 = m_audio.size() - m_audio_pos;
        memcpy(&m_audio[m_audio_pos], samples, n0 * sizeof(float));
        memcpy(&m_audio[0], samples + n0, (n_samples - n0) * sizeof(float));
    } else {
        memcpy(&m_audio[m_audio_pos], samples, n_samples * sizeof(float));
    }
    m_audio_pos = (m_audio_pos + n_samples) % m_audio.size();
    m_audio_len = ((m_audio_len + n_samples < m_audio.size()) ? (m_audio_len + n_samples) : m_audio.size());
    return true;
}

void audio_async::get(int ms, std::vector<float> & result) {
    result.clear();
    std::lock_guard<std::mutex> lock(m_mutex);
    if (ms <= 0) {
        ms = m_len_ms;
    }

    size_t n_samples = (m_sample_rate * ms) / 1000;
    n_samples = (n_samples < m_audio_len) ? n_samples : m_audio_len;
    result.resize(n_samples);

    int s0 = static_cast<int>(m_audio_pos - n_samples);
    if (s0 < 0) {
        s0 += static_cast<int>(m_audio.size());
    }

    if (s0 + n_samples > m_audio.size()) {
        const size_t n0 = m_audio.size() - s0;
        memcpy(&result[0], &m_audio[s0], n0 * sizeof(float));
        memcpy(&result[n0], &m_audio[0], (n_samples - n0) * sizeof(float));
    } else {
        memcpy(&result[0], &m_audio[s0], n_samples * sizeof(float));
    }
}

void audio_async::capture_loop() {
    com_init com;
    IMMDeviceEnumerator * enumerator = nullptr;
    IMMDevice * device = nullptr;
    IAudioClient * audio_client = nullptr;
    IAudioCaptureClient * capture_client = nullptr;
    WAVEFORMATEX * mix_format = nullptr;

    HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
    if (FAILED(hr)) goto done;
    device = select_render_device(enumerator, m_render_id);
    if (!device) goto done;
    hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void **>(&audio_client));
    if (FAILED(hr)) goto done;
    hr = audio_client->GetMixFormat(&mix_format);
    if (FAILED(hr)) goto done;

    REFERENCE_TIME buffer_duration = 10000000;
    hr = audio_client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, buffer_duration, 0, mix_format, nullptr);
    if (FAILED(hr)) goto done;
    hr = audio_client->GetService(IID_PPV_ARGS(&capture_client));
    if (FAILED(hr)) goto done;
    hr = audio_client->Start();
    if (FAILED(hr)) goto done;

    fprintf(stderr, "loopback: capture started at %u Hz, %u channels, %u bits\n",
            mix_format->nSamplesPerSec, mix_format->nChannels, mix_format->wBitsPerSample);

    while (!m_stop) {
        UINT32 packet_frames = 0;
        hr = capture_client->GetNextPacketSize(&packet_frames);
        if (FAILED(hr)) break;
        if (packet_frames == 0) {
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
            continue;
        }

        BYTE * data = nullptr;
        UINT32 frames = 0;
        DWORD flags = 0;
        hr = capture_client->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
        if (FAILED(hr)) break;

        std::vector<float> mono;
        mono.reserve(frames);
        const WORD channels = ((mix_format->nChannels > 0) ? mix_format->nChannels : 1);
        const WORD bits = mix_format->wBitsPerSample;
        for (UINT32 frame = 0; frame < frames; ++frame) {
            float value = 0.0f;
            if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT)) {
                for (WORD ch = 0; ch < channels; ++ch) {
                    value += sample_to_float(data, bits, mix_format, frame, ch);
                }
                value /= channels;
            }
            mono.push_back(((value < -1.0f) ? -1.0f : ((value > 1.0f) ? 1.0f : value)));
        }
        std::vector<float> resampled = resample_linear(mono, mix_format->nSamplesPerSec, m_sample_rate);
        append_samples(resampled.data(), resampled.size());
        capture_client->ReleaseBuffer(frames);
    }

    if (audio_client) {
        audio_client->Stop();
    }

done:
    if (FAILED(hr)) {
        fprintf(stderr, "loopback: capture failed: 0x%08lx\n", static_cast<unsigned long>(hr));
    }
    if (mix_format) {
        CoTaskMemFree(mix_format);
    }
    release(capture_client);
    release(audio_client);
    release(device);
    release(enumerator);
}

bool loopback_poll_events() {
    return true;
}
