// Shared optional-argument parsing for the CLI tools.
// Every tool takes <input> <output> first, so extra arguments start at index 3.
#pragma once

#include <cstdlib>
#include <iostream>
#include <string>

namespace cli {

inline void fail(const char* name, const char* text) {
    std::cerr << name << " must be " << text << "\n";
    std::exit(1);
}

inline int intArg(int argc, char* argv[], int index, const char* name, int fallback,
                  int minimum = INT32_MIN, int maximum = INT32_MAX) {
    if (index >= argc || std::string(argv[index]).empty()) return fallback;
    try {
        const std::string text = argv[index];
        std::size_t used = 0;
        const int value = std::stoi(text, &used);
        if (used != text.size()) fail(name, "a whole number");
        if (value < minimum || value > maximum) fail(name, "within its allowed range");
        return value;
    } catch (const std::exception&) {
        fail(name, "a whole number");
    }
    return fallback;
}

inline double doubleArg(int argc, char* argv[], int index, const char* name, double fallback,
                        double minimum = -1e300, double maximum = 1e300) {
    if (index >= argc || std::string(argv[index]).empty()) return fallback;
    try {
        const std::string text = argv[index];
        std::size_t used = 0;
        const double value = std::stod(text, &used);
        if (used != text.size()) fail(name, "a number");
        if (value < minimum || value > maximum) fail(name, "within its allowed range");
        return value;
    } catch (const std::exception&) {
        fail(name, "a number");
    }
    return fallback;
}

inline bool boolArg(int argc, char* argv[], int index, const char* name, bool fallback) {
    if (index >= argc || std::string(argv[index]).empty()) return fallback;
    const std::string text = argv[index];
    if (text == "1" || text == "true") return true;
    if (text == "0" || text == "false") return false;
    fail(name, "0 or 1");
    return fallback;
}

// Odd sizes are required by several OpenCV kernels.
inline int oddIntArg(int argc, char* argv[], int index, const char* name, int fallback,
                     int minimum, int maximum) {
    const int value = intArg(argc, argv, index, name, fallback, minimum, maximum);
    if (value % 2 == 0) fail(name, "an odd number");
    return value;
}

} // namespace cli
