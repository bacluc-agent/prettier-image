#!/bin/sh
set -e

# Resolve the installed prettier plugin entry files by absolute path.
# prettier 3 resolves --plugin=<name> relative to the working directory,
# not the install location, so we pass absolute paths to guarantee
# discovery regardless of where the image is run from.
PLUGIN_FLAGS=$(
  node -e "
    const deps = process.env.PRETTIER_DEPS;
    if (!deps) process.exit(0);
    const names = [
      '@prettier/plugin-xml',
      '@trivago/prettier-plugin-sort-imports',
      'prettier-plugin-nginx',
      'prettier-plugin-packagejson',
      'prettier-plugin-properties',
      'prettier-plugin-sh',
      'prettier-plugin-sort-json',
      'prettier-plugin-sql',
      'prettier-plugin-toml',
    ];
    const out = [];
    for (const n of names) {
      try {
        out.push('--plugin=' + require.resolve(n, { paths: [deps] }));
      } catch (e) {}
    }
    process.stdout.write(out.join(' '));
  "
)

# If no arguments, run prettier on all supported files
if [ $# -eq 0 ]; then
    exec prettier $PLUGIN_FLAGS --write "**/*.{js,jsx,ts,tsx,html,css,scss,json,md,yaml,yml,sql,toml,xml,properties,nginx,nginxconf,vhost,Dockerfile}"
else
    exec prettier $PLUGIN_FLAGS "$@"
fi
