// Contrast stretching (auto-levels): map a chosen input range onto the full output range.
#include <algorithm>
#include <cmath>
#include <iostream>
#include <string>
#include <vector>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

namespace {

// Cumulative histogram over every channel, so one scale is applied to the whole image.
std::vector<double> histogram(const cv::Mat& image, int bins) {
    std::vector<double> counts(static_cast<size_t>(bins), 0.0);
    const int channels = image.channels();
    for (int row = 0; row < image.rows; ++row) {
        if (image.depth() == CV_16U) {
            const uint16_t* p = image.ptr<uint16_t>(row);
            for (int i = 0; i < image.cols * channels; ++i) counts[p[i]] += 1.0;
        } else {
            const uint8_t* p = image.ptr<uint8_t>(row);
            for (int i = 0; i < image.cols * channels; ++i) counts[p[i]] += 1.0;
        }
    }
    return counts;
}

// Value below which `fraction` of the samples fall.
int percentileValue(const std::vector<double>& counts, double total, double fraction) {
    const double target = total * fraction;
    double running = 0.0;
    for (size_t value = 0; value < counts.size(); ++value) {
        running += counts[value];
        if (running >= target) return static_cast<int>(value);
    }
    return static_cast<int>(counts.size()) - 1;
}

} // namespace

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: stretch_cli <input_image> <output_image> [mode] [low] [high]\n"
                     "  mode=percentile  low/high are percentages (default 0.5 and 99.5)\n"
                     "  mode=minmax      uses the darkest and brightest pixels\n"
                     "  mode=bits        low is the sensor bit depth, e.g. 12\n";
        return 1;
    }

    const std::string input_path = argv[1];
    const std::string output_path = argv[2];
    const std::string mode = argc > 3 ? argv[3] : "percentile";

    double low = 0.5;
    double high = 99.5;
    try {
        if (argc > 4) low = std::stod(argv[4]);
        if (argc > 5) high = std::stod(argv[5]);
    } catch (const std::exception&) {
        std::cerr << "low and high must be numbers\n";
        return 1;
    }

    if (mode != "percentile" && mode != "minmax" && mode != "bits") {
        std::cerr << "mode must be percentile, minmax or bits\n";
        return 1;
    }
    if (mode == "percentile" && (low < 0.0 || high > 100.0 || low >= high)) {
        std::cerr << "percentile mode needs 0 <= low < high <= 100\n";
        return 1;
    }
    if (mode == "bits") {
        const int bits = static_cast<int>(std::lround(low));
        if (bits < 1 || bits > 16) {
            std::cerr << "bits mode needs a bit depth between 1 and 16\n";
            return 1;
        }
    }

    // IMREAD_UNCHANGED keeps the original 16-bit values; the usual colour read would discard them.
    const cv::Mat image = cv::imread(input_path, cv::IMREAD_UNCHANGED);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << input_path << "\n";
        return 2;
    }
    if (image.depth() != CV_8U && image.depth() != CV_16U) {
        std::cerr << "Only 8-bit and 16-bit images are supported\n";
        return 2;
    }

    const int bins = image.depth() == CV_16U ? 65536 : 256;
    double lo = 0.0;
    double hi = bins - 1.0;

    if (mode == "bits") {
        hi = std::pow(2.0, std::lround(low)) - 1.0;
    } else {
        const std::vector<double> counts = histogram(image, bins);
        const double total = static_cast<double>(image.rows) * image.cols * image.channels();
        if (mode == "minmax") {
            double minValue = 0.0;
            double maxValue = 0.0;
            cv::minMaxLoc(image.reshape(1), &minValue, &maxValue);
            lo = minValue;
            hi = maxValue;
        } else {
            lo = percentileValue(counts, total, low / 100.0);
            hi = percentileValue(counts, total, high / 100.0);
        }
    }

    if (hi <= lo) {
        std::cerr << "Input range is empty (low " << lo << ", high " << hi << "); the image may be blank\n";
        return 1;
    }

    // Output is 8-bit so the result displays the same way as every other tool's output.
    const double scale = 255.0 / (hi - lo);
    cv::Mat output;
    image.convertTo(output, CV_8U, scale, -lo * scale);

    if (!cv::imwrite(output_path, output)) {
        std::cerr << "Failed to write output image: " << output_path << "\n";
        return 3;
    }

    std::cout << output_path << "\n";
    std::cout << "mode=" << mode << " input_range=[" << lo << ", " << hi << "]"
              << " source_depth=" << (image.depth() == CV_16U ? 16 : 8) << "-bit"
              << " channels=" << image.channels() << "\n";
    return 0;
}
