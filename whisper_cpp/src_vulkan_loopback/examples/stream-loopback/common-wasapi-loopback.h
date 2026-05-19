#pragma once

#include <atomic>
#include <cstdint>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

class audio_async {
public:
    audio_async(int len_ms);
    ~audio_async();

    bool init(int render_id, int sample_rate);
    bool resume();
    bool pause();
    bool clear();
    bool set_recording_path(const std::string & path);
    void get(int ms, std::vector<float> & audio);

private:
    void capture_loop();
    bool append_samples(const float * samples, size_t n_samples);

    int m_len_ms = 0;
    int m_sample_rate = 0;
    int m_render_id = -1;
    std::string m_recording_path;

    std::atomic_bool m_running{false};
    std::atomic_bool m_stop{false};
    std::thread m_thread;
    std::mutex m_mutex;

    std::vector<float> m_audio;
    size_t m_audio_pos = 0;
    size_t m_audio_len = 0;
};

bool loopback_poll_events();
