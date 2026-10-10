cmake_minimum_required(VERSION 3.21)

# Builds every cv-cli/cpp-* tool in one tree and installs them, with their shared
# libraries, into a self-contained folder (normally <repo>/native) that Electron runs
# and packages. Works on macOS, Linux and Windows, with vcpkg or system packages.
project(orbital_eyes_native VERSION 0.9.0 LANGUAGES CXX)

option(OE_BUNDLE_RUNTIME "Copy non-system shared libraries (OpenCV and friends) into the install folder" ON)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

if(MSVC)
    add_compile_options(/utf-8 /EHsc /permissive-)
    add_compile_definitions(_USE_MATH_DEFINES NOMINMAX)
endif()

# Installed tools look for bundled libraries in ../lib (macOS/Linux); Windows uses DLLs beside the .exe.
if(OE_BUNDLE_RUNTIME)
    if(APPLE)
        set(CMAKE_INSTALL_RPATH "@loader_path/../lib")
    elseif(UNIX)
        set(CMAKE_INSTALL_RPATH "$ORIGIN/../lib")
    endif()
else()
    set(CMAKE_INSTALL_RPATH_USE_LINK_PATH ON)
endif()

# Probe OpenCV in a function scope: a component-less find_package sets OpenCV_LIBS to every
# module, which would otherwise leak into the subprojects and over-link them.
function(oe_probe_opencv)
    find_package(OpenCV REQUIRED)
    set(OE_OPENCV_VERSION "${OpenCV_VERSION}" PARENT_SCOPE)
    if("opencv_xfeatures2d" IN_LIST OpenCV_LIBS)
        set(OE_HAVE_XFEATURES2D ON PARENT_SCOPE)
    else()
        set(OE_HAVE_XFEATURES2D OFF PARENT_SCOPE)
    endif()
    message(STATUS "OpenCV ${OpenCV_VERSION}: ${OpenCV_DIR}")
endfunction()
oe_probe_opencv()
find_package(nlohmann_json REQUIRED)

file(GLOB OE_PROJECT_DIRS LIST_DIRECTORIES true RELATIVE "${CMAKE_CURRENT_SOURCE_DIR}" "${CMAKE_CURRENT_SOURCE_DIR}/cpp-*")
list(SORT OE_PROJECT_DIRS)

set(OE_TOOLS "")
foreach(project_dir IN LISTS OE_PROJECT_DIRS)
    if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/${project_dir}/CMakeLists.txt")
        continue()
    endif()
    if(project_dir STREQUAL "cpp-surf" AND NOT OE_HAVE_XFEATURES2D)
        message(WARNING "Skipping cpp-surf: OpenCV was built without opencv_contrib (xfeatures2d).")
        continue()
    endif()
    add_subdirectory("${project_dir}")
    get_property(project_targets DIRECTORY "${project_dir}" PROPERTY BUILDSYSTEM_TARGETS)
    foreach(target IN LISTS project_targets)
        if(target MATCHES "_cli$")
            list(APPEND OE_TOOLS "${target}")
        endif()
    endforeach()
endforeach()

list(LENGTH OE_TOOLS OE_TOOL_COUNT)
message(STATUS "Orbital Eyes native tools (${OE_TOOL_COUNT}): ${OE_TOOLS}")

install(TARGETS ${OE_TOOLS} RUNTIME_DEPENDENCY_SET oe_runtime RUNTIME DESTINATION bin)

if(OE_BUNDLE_RUNTIME)
    set(OE_RUNTIME_DIRS "")
    if(DEFINED VCPKG_INSTALLED_DIR AND DEFINED VCPKG_TARGET_TRIPLET)
        list(APPEND OE_RUNTIME_DIRS
            "${VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/bin"
            "${VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/lib")
    endif()
    install(RUNTIME_DEPENDENCY_SET oe_runtime
        PRE_EXCLUDE_REGEXES "^api-ms-" "^ext-ms-" "^hvsifiledll" "^pdmutilities"
        POST_EXCLUDE_REGEXES
            "[Ss][Yy][Ss][Tt][Ee][Mm]32" "[Ss][Yy][Ss][Ww][Oo][Ww]64"
            "^/usr/lib/" "^/lib/" "^/lib64/" "^/usr/lib64/" "^/System/"
        DIRECTORIES ${OE_RUNTIME_DIRS}
        RUNTIME DESTINATION bin
        LIBRARY DESTINATION lib
        FRAMEWORK DESTINATION lib)
endif()

# Install-time rpath edits invalidate the linker's ad-hoc signature, and Apple Silicon refuses to run
# unsigned code. Re-sign ad hoc; electron-builder replaces this with the real identity when packaging.
if(APPLE)
    install(CODE [[
        file(GLOB oe_signables "${CMAKE_INSTALL_PREFIX}/bin/*" "${CMAKE_INSTALL_PREFIX}/lib/*.dylib")
        foreach(oe_file IN LISTS oe_signables)
            if(NOT IS_SYMLINK "${oe_file}")
                execute_process(COMMAND codesign --force --sign - "${oe_file}" RESULT_VARIABLE oe_sign_result ERROR_QUIET)
                if(NOT oe_sign_result EQUAL 0)
                    message(WARNING "codesign failed for ${oe_file}")
                endif()
            endif()
        endforeach()
    ]])
endif()

string(REPLACE ";" "\", \"" OE_TOOLS_JSON "${OE_TOOLS}")
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/native-info.json"
"{
  \"opencv\": \"${OE_OPENCV_VERSION}\",
  \"system\": \"${CMAKE_SYSTEM_NAME}\",
  \"processor\": \"${CMAKE_SYSTEM_PROCESSOR}\",
  \"compiler\": \"${CMAKE_CXX_COMPILER_ID} ${CMAKE_CXX_COMPILER_VERSION}\",
  \"vcpkgTriplet\": \"${VCPKG_TARGET_TRIPLET}\",
  \"bundledRuntime\": $<IF:$<BOOL:${OE_BUNDLE_RUNTIME}>,true,false>,
  \"tools\": [\"${OE_TOOLS_JSON}\"]
}
")
file(GENERATE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/native-info-$<CONFIG>.json"
    INPUT "${CMAKE_CURRENT_BINARY_DIR}/native-info.json")
install(FILES "${CMAKE_CURRENT_BINARY_DIR}/native-info-$<CONFIG>.json" DESTINATION . RENAME native-info.json)
