#include <crow.h>

#include "attitude_server.hpp"
#include "common/common.hpp"

int main() {
  navlib::common::init_logging("attitude_server");

  crow::SimpleApp app;
  navlib::attitude::server::register_routes(app);
  app.port(8083).multithreaded().run();

  return 0;
}
