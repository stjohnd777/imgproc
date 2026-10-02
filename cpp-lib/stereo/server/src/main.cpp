#include <crow.h>

#include "common/common.hpp"
#include "stereo_server.hpp"

int main() {
  navlib::common::init_logging("stereo_server");

  crow::SimpleApp app;
  navlib::stereo::server::register_routes(app);
  app.port(8082).multithreaded().run();

  return 0;
}
