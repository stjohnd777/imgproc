file(GLOB_RECURSE BEARING_SOURCES CONFIGURE_DEPENDS src/*.cpp)
file(GLOB_RECURSE BEARING_HEADERS CONFIGURE_DEPENDS include/*.hpp include/*.h)

add_library(navlib_bearing STATIC ${BEARING_SOURCES} ${BEARING_HEADERS})
add_library(navlib::bearing ALIAS navlib_bearing)

target_include_directories(navlib_bearing PUBLIC
  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
)

target_link_libraries(navlib_bearing PUBLIC navlib::common)

add_subdirectory(test)
add_subdirectory(example)
add_subdirectory(server)
