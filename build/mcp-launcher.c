// jaffloop-mcp: starts the Jaffloop MCP server (stdio) with the app's own runtime, so nothing else has to be installed.
// It lives at Contents/MacOS/jaffloop-mcp, the same path the Swift app used, so Claude configs made for 0.0.x keep working.
// A compiled launcher (not a shell script) because code signing refuses unsigned scripts inside Contents/MacOS.
#include <libgen.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int main(int argc, char **argv) {
  char raw[PATH_MAX], self[PATH_MAX];
  uint32_t size = sizeof raw;
  if (_NSGetExecutablePath(raw, &size) != 0 || !realpath(raw, self)) { fprintf(stderr, "jaffloop-mcp: cannot find itself\n"); return 127; }
  char *dir = dirname(self); // .../Jaffloop.app/Contents/MacOS
  char app[PATH_MAX], server[PATH_MAX];
  snprintf(app, sizeof app, "%s/Jaffloop", dir);
  snprintf(server, sizeof server, "%s/../Resources/app/dist/mcp/server.cjs", dir);
  setenv("ELECTRON_RUN_AS_NODE", "1", 1);
  char **args = calloc((size_t)argc + 2, sizeof *args);
  args[0] = app;
  args[1] = server;
  for (int i = 1; i < argc; i++) args[i + 1] = argv[i];
  execv(app, args);
  perror("jaffloop-mcp: cannot start Jaffloop");
  return 127;
}
