#include <crow.h>

#include "bearing_server.hpp"
#include "common/common.hpp"

int main() {
  navlib::common::init_logging("bearing_server");

  crow::SimpleApp app;
  navlib::bearing::server::register_routes(app);
  app.port(8081).multithreaded().run();

  return 0;
}
