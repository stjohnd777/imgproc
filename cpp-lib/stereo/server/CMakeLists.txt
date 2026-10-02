file(GLOB_RECURSE STEREO_SERVER_SOURCES CONFIGURE_DEPENDS src/*.cpp)
file(GLOB_RECURSE STEREO_SERVER_HEADERS CONFIGURE_DEPENDS include/*.hpp include/*.h)

add_executable(stereo_server ${STEREO_SERVER_SOURCES} ${STEREO_SERVER_HEADERS})

target_include_directories(stereo_server PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(stereo_server PRIVATE
  navlib::common
  navlib::stereo
  Crow::Crow
)

add_subdirectory(test)
