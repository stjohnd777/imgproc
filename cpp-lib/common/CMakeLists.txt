file(GLOB_RECURSE COMMON_SOURCES CONFIGURE_DEPENDS src/*.cpp)
file(GLOB_RECURSE COMMON_HEADERS CONFIGURE_DEPENDS include/*.hpp include/*.h)

add_library(navlib_common STATIC ${COMMON_SOURCES} ${COMMON_HEADERS})
add_library(navlib::common ALIAS navlib_common)

target_include_directories(navlib_common PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
  ${OpenCV_INCLUDE_DIRS}
)

target_link_libraries(navlib_common PUBLIC
  ${OpenCV_LIBS}
  Eigen3::Eigen
  nlohmann_json::nlohmann_json
  spdlog::spdlog
)

add_subdirectory(test)
