file(GLOB_RECURSE BEARING_SERVER_SOURCES CONFIGURE_DEPENDS src/*.cpp)
file(GLOB_RECURSE BEARING_SERVER_HEADERS CONFIGURE_DEPENDS include/*.hpp include/*.h)

add_executable(bearing_server ${BEARING_SERVER_SOURCES} ${BEARING_SERVER_HEADERS})

target_include_directories(bearing_server PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(bearing_server PRIVATE
  navlib::common
  navlib::bearing
  Crow::Crow
)

add_subdirectory(test)
