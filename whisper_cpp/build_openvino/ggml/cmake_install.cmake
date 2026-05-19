# Install script for directory: C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml

# Set the install prefix
if(NOT DEFINED CMAKE_INSTALL_PREFIX)
  set(CMAKE_INSTALL_PREFIX "C:/Program Files (x86)/whisper.cpp")
endif()
string(REGEX REPLACE "/$" "" CMAKE_INSTALL_PREFIX "${CMAKE_INSTALL_PREFIX}")

# Set the install configuration name.
if(NOT DEFINED CMAKE_INSTALL_CONFIG_NAME)
  if(BUILD_TYPE)
    string(REGEX REPLACE "^[^A-Za-z0-9_]+" ""
           CMAKE_INSTALL_CONFIG_NAME "${BUILD_TYPE}")
  else()
    set(CMAKE_INSTALL_CONFIG_NAME "Release")
  endif()
  message(STATUS "Install configuration: \"${CMAKE_INSTALL_CONFIG_NAME}\"")
endif()

# Set the component getting installed.
if(NOT CMAKE_INSTALL_COMPONENT)
  if(COMPONENT)
    message(STATUS "Install component: \"${COMPONENT}\"")
    set(CMAKE_INSTALL_COMPONENT "${COMPONENT}")
  else()
    set(CMAKE_INSTALL_COMPONENT)
  endif()
endif()

# Is this installation the result of a crosscompile?
if(NOT DEFINED CMAKE_CROSSCOMPILING)
  set(CMAKE_CROSSCOMPILING "FALSE")
endif()

if(NOT CMAKE_INSTALL_LOCAL_ONLY)
  # Include the install script for the subdirectory.
  include("C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/ggml/src/cmake_install.cmake")
endif()

if("x${CMAKE_INSTALL_COMPONENT}x" STREQUAL "xUnspecifiedx" OR NOT CMAKE_INSTALL_COMPONENT)
  if("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Dd][Ee][Bb][Uu][Gg])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib" TYPE STATIC_LIBRARY OPTIONAL FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/ggml/src/Debug/ggml.lib")
  elseif("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Rr][Ee][Ll][Ee][Aa][Ss][Ee])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib" TYPE STATIC_LIBRARY OPTIONAL FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/ggml/src/Release/ggml.lib")
  elseif("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Mm][Ii][Nn][Ss][Ii][Zz][Ee][Rr][Ee][Ll])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib" TYPE STATIC_LIBRARY OPTIONAL FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/ggml/src/MinSizeRel/ggml.lib")
  elseif("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Rr][Ee][Ll][Ww][Ii][Tt][Hh][Dd][Ee][Bb][Ii][Nn][Ff][Oo])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib" TYPE STATIC_LIBRARY OPTIONAL FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/ggml/src/RelWithDebInfo/ggml.lib")
  endif()
endif()

if("x${CMAKE_INSTALL_COMPONENT}x" STREQUAL "xUnspecifiedx" OR NOT CMAKE_INSTALL_COMPONENT)
  if("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Dd][Ee][Bb][Uu][Gg])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/bin" TYPE SHARED_LIBRARY FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/bin/Debug/ggml.dll")
  elseif("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Rr][Ee][Ll][Ee][Aa][Ss][Ee])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/bin" TYPE SHARED_LIBRARY FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/bin/Release/ggml.dll")
  elseif("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Mm][Ii][Nn][Ss][Ii][Zz][Ee][Rr][Ee][Ll])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/bin" TYPE SHARED_LIBRARY FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/bin/MinSizeRel/ggml.dll")
  elseif("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Rr][Ee][Ll][Ww][Ii][Tt][Hh][Dd][Ee][Bb][Ii][Nn][Ff][Oo])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/bin" TYPE SHARED_LIBRARY FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/bin/RelWithDebInfo/ggml.dll")
  endif()
endif()

if("x${CMAKE_INSTALL_COMPONENT}x" STREQUAL "xUnspecifiedx" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/include" TYPE FILE FILES
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-cpu.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-alloc.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-backend.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-blas.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-cann.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-cpp.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-cuda.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-opt.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-metal.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-rpc.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-virtgpu.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-sycl.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-vulkan.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-webgpu.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-zendnn.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/ggml-openvino.h"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/src_vulkan_loopback/ggml/include/gguf.h"
    )
endif()

if("x${CMAKE_INSTALL_COMPONENT}x" STREQUAL "xUnspecifiedx" OR NOT CMAKE_INSTALL_COMPONENT)
  if("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Dd][Ee][Bb][Uu][Gg])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib" TYPE STATIC_LIBRARY OPTIONAL FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/ggml/src/Debug/ggml-base.lib")
  elseif("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Rr][Ee][Ll][Ee][Aa][Ss][Ee])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib" TYPE STATIC_LIBRARY OPTIONAL FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/ggml/src/Release/ggml-base.lib")
  elseif("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Mm][Ii][Nn][Ss][Ii][Zz][Ee][Rr][Ee][Ll])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib" TYPE STATIC_LIBRARY OPTIONAL FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/ggml/src/MinSizeRel/ggml-base.lib")
  elseif("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Rr][Ee][Ll][Ww][Ii][Tt][Hh][Dd][Ee][Bb][Ii][Nn][Ff][Oo])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib" TYPE STATIC_LIBRARY OPTIONAL FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/ggml/src/RelWithDebInfo/ggml-base.lib")
  endif()
endif()

if("x${CMAKE_INSTALL_COMPONENT}x" STREQUAL "xUnspecifiedx" OR NOT CMAKE_INSTALL_COMPONENT)
  if("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Dd][Ee][Bb][Uu][Gg])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/bin" TYPE SHARED_LIBRARY FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/bin/Debug/ggml-base.dll")
  elseif("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Rr][Ee][Ll][Ee][Aa][Ss][Ee])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/bin" TYPE SHARED_LIBRARY FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/bin/Release/ggml-base.dll")
  elseif("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Mm][Ii][Nn][Ss][Ii][Zz][Ee][Rr][Ee][Ll])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/bin" TYPE SHARED_LIBRARY FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/bin/MinSizeRel/ggml-base.dll")
  elseif("${CMAKE_INSTALL_CONFIG_NAME}" MATCHES "^([Rr][Ee][Ll][Ww][Ii][Tt][Hh][Dd][Ee][Bb][Ii][Nn][Ff][Oo])$")
    file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/bin" TYPE SHARED_LIBRARY FILES "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/bin/RelWithDebInfo/ggml-base.dll")
  endif()
endif()

if("x${CMAKE_INSTALL_COMPONENT}x" STREQUAL "xUnspecifiedx" OR NOT CMAKE_INSTALL_COMPONENT)
  file(INSTALL DESTINATION "${CMAKE_INSTALL_PREFIX}/lib/cmake/ggml" TYPE FILE FILES
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/ggml/ggml-config.cmake"
    "C:/Users/alten/Desktop/ku/local-meeting-stt/whisper_cpp/build_openvino/ggml/ggml-version.cmake"
    )
endif()

