set(TARGET whisper-stream-loopback)
add_executable(${TARGET} stream-loopback.cpp common-wasapi-loopback.cpp common-wasapi-loopback.h)
target_link_libraries(${TARGET} PRIVATE common whisper ${CMAKE_THREAD_LIBS_INIT} ole32 uuid)
install(TARGETS ${TARGET} RUNTIME)
