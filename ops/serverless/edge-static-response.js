// Replace the policy placeholder with a JSON-encoded, reviewed CSP at packaging time.
// Associate only with the default frontend and /assets/* viewer-response events.
var policy = __OPENSIGHT_CSP__;
function handler(event) {
  var response = event.response;
  response.headers['content-security-policy'] = { value: policy };
  return response;
}
