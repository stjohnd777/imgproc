#include <iostream>
#include <string>
#include <opencv2/core.hpp>
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: fourier_cli <input_image> <output_image>\n";
        return 1;
    }

    const std::string inputPath = argv[1];
    const std::string outputPath = argv[2];
    const cv::Mat image = cv::imread(inputPath, cv::IMREAD_GRAYSCALE);
    if (image.empty()) {
        std::cerr << "Failed to load input image: " << inputPath << "\n";
        return 2;
    }

    const int optimalRows = cv::getOptimalDFTSize(image.rows);
    const int optimalCols = cv::getOptimalDFTSize(image.cols);
    cv::Mat padded;
    cv::copyMakeBorder(image, padded, 0, optimalRows - image.rows, 0, optimalCols - image.cols,
                       cv::BORDER_CONSTANT, cv::Scalar::all(0));
    padded.convertTo(padded, CV_32F);

    cv::Mat planes[] = { padded, cv::Mat::zeros(padded.size(), CV_32F) };
    cv::Mat complexSpectrum;
    cv::merge(planes, 2, complexSpectrum);
    cv::dft(complexSpectrum, complexSpectrum);

    cv::split(complexSpectrum, planes);
    cv::magnitude(planes[0], planes[1], planes[0]);
    cv::Mat magnitude = planes[0];
    magnitude += cv::Scalar::all(1.0f);
    cv::log(magnitude, magnitude);

    // Put low frequencies in the center of the display image.
    magnitude = magnitude(cv::Rect(0, 0, magnitude.cols & -2, magnitude.rows & -2));
    const int cx = magnitude.cols / 2;
    const int cy = magnitude.rows / 2;
    cv::Mat topLeft(magnitude, cv::Rect(0, 0, cx, cy));
    cv::Mat topRight(magnitude, cv::Rect(cx, 0, cx, cy));
    cv::Mat bottomLeft(magnitude, cv::Rect(0, cy, cx, cy));
    cv::Mat bottomRight(magnitude, cv::Rect(cx, cy, cx, cy));
    cv::Mat temporary;
    topLeft.copyTo(temporary);
    bottomRight.copyTo(topLeft);
    temporary.copyTo(bottomRight);
    topRight.copyTo(temporary);
    bottomLeft.copyTo(topRight);
    temporary.copyTo(bottomLeft);

    cv::normalize(magnitude, magnitude, 0, 255, cv::NORM_MINMAX);
    cv::Mat output;
    magnitude.convertTo(output, CV_8U);

    if (!cv::imwrite(outputPath, output)) {
        std::cerr << "Failed to write output image: " << outputPath << "\n";
        return 3;
    }

    std::cout << outputPath << "\n";
    return 0;
}
