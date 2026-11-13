import { createServer } from "node:http";

// Two fake services for the demo. Start one only with: node server.mjs api
const services = {
  api: { port: 4101, path: "/health" },
  front: { port: 4102, path: "/" },
};
const wanted = process.argv.slice(2);

for (const [name, { port, path }] of Object.entries(services)) {
  if (wanted.length > 0 && !wanted.includes(name)) continue;
  createServer((request, response) => {
    response.writeHead(request.url === path ? 200 : 404).end(`${name}\n`);
  }).listen(port, "127.0.0.1", () =>
    console.log(`${name} listening on http://127.0.0.1:${port}${path}`),
  );
}
