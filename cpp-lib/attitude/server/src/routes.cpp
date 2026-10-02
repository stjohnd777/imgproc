#include "attitude_server.hpp"

#include "attitude/attitude.hpp"

namespace navlib::attitude::server {

void register_routes(crow::SimpleApp& app) {
  CROW_ROUTE(app, "/attitude/health")
  ([]() { return crow::response(200, "attitude: ok"); });

  CROW_ROUTE(app, "/attitude/hello")
  ([]() {
    const auto result = navlib::attitude::estimate_attitude_hello_world();
    crow::json::wvalue body;
    body["roll_deg"] = result.roll_deg;
    body["pitch_deg"] = result.pitch_deg;
    body["yaw_deg"] = result.yaw_deg;
    return crow::response(body);
  });
}

} // namespace navlib::attitude::server
