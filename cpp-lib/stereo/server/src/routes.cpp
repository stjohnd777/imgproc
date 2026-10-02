#include "stereo_server.hpp"

#include "stereo/stereo.hpp"

namespace navlib::stereo::server {

void register_routes(crow::SimpleApp& app) {
  CROW_ROUTE(app, "/stereo/health")
  ([]() { return crow::response(200, "stereo: ok"); });

  CROW_ROUTE(app, "/stereo/hello")
  ([]() {
    const auto result = navlib::stereo::estimate_stereo_hello_world();
    crow::json::wvalue body;
    body["disparity"] = result.disparity;
    return crow::response(body);
  });
}

} // namespace navlib::stereo::server
