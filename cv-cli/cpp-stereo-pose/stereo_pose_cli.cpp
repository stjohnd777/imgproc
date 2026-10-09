#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

namespace {
void usage(std::ostream& out) {
    out << "Usage: stereo_pose_cli left_image right_image model.onnx "
           "model_metadata.json pose.json\n"
           "Fixed-rig grayscale stereo pose estimator (stub).\n"
           "ONNX Runtime inference is not implemented; no pose output is written.\n";
}
}

int main(int argc, char* argv[]) {
    if (argc == 2 && (std::string(argv[1]) == "--help" || std::string(argv[1]) == "-h")) {
        usage(std::cout);
        return 0;
    }
    if (argc != 6) {
        usage(std::cerr);
        return 2;
    }

    const char* labels[] = {"left image", "right image", "ONNX model", "model metadata"};
    for (int i = 1; i <= 4; ++i) {
        std::error_code error;
        if (!std::filesystem::is_regular_file(argv[i], error) || error ||
            !std::ifstream(argv[i], std::ios::binary).good()) {
            std::cerr << "stereo_pose_cli: missing or unreadable " << labels[i - 1]
                      << ": " << argv[i] << '\n';
            return 2;
        }
    }
    if (std::string(argv[5]).empty()) {
        std::cerr << "stereo_pose_cli: pose output path must not be empty.\n";
        return 2;
    }

    std::cerr << "stereo_pose_cli: ONNX Runtime inference is not implemented "
                 "(CLI stub). No pose output was written.\n";
    return 3;
}
