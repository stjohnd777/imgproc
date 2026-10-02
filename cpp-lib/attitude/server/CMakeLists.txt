file(GLOB_RECURSE ATTITUDE_SERVER_SOURCES CONFIGURE_DEPENDS src/*.cpp)
file(GLOB_RECURSE ATTITUDE_SERVER_HEADERS CONFIGURE_DEPENDS include/*.hpp include/*.h)

add_executable(attitude_server ${ATTITUDE_SERVER_SOURCES} ${ATTITUDE_SERVER_HEADERS})

target_include_directories(attitude_server PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(attitude_server PRIVATE
  navlib::common
  navlib::attitude
  Crow::Crow
)

add_subdirectory(test)
