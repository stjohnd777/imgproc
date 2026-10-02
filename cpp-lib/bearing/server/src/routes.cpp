#include "bearing_server.hpp"

#include "bearing/bearing.hpp"

namespace navlib::bearing::server {

void register_routes(crow::SimpleApp& app) {
  CROW_ROUTE(app, "/bearing/health")
  ([]() { return crow::response(200, "bearing: ok"); });

  CROW_ROUTE(app, "/bearing/hello")
  ([]() {
    const auto result = navlib::bearing::estimate_bearing_hello_world();
    crow::json::wvalue body;
    body["degrees"] = result.degrees;
    return crow::response(body);
  });
}

} // namespace navlib::bearing::server
