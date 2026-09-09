# Prettier Docker Image

A Docker image for running Prettier with .gitignore support.

## Features

- **Gitignore Support**: Respects .gitignore patterns
- **Flexible Arguments**: Pass any prettier arguments
- **Plugins**: Formats JSON, package.json, SQL, Dockerfiles, TOML, XML, properties, and nginx configs via plugins

## Usage

```bash
# Format all files in current directory
docker compose run --rm prettier

# Format specific files
docker compose run --rm prettier --write 'test-files/**/*.js'

# Check formatting
docker compose run --rm prettier --check '**/*.js'
```

## Test Files

The `test-files/` directory contains sample files for testing.

## Plugins

The image bundles these Prettier plugins (versions tracked in [`package.json`](package.json)):

| Plugin                                  | Formats                        |
| --------------------------------------- | ------------------------------ |
| `@prettier/plugin-xml`                  | `.xml` and XML-based files     |
| `@trivago/prettier-plugin-sort-imports` | TS/JS import ordering          |
| `prettier-plugin-nginx`                 | nginx config files             |
| `prettier-plugin-packagejson`           | `package.json` key ordering    |
| `prettier-plugin-properties`            | `.properties` files            |
| `prettier-plugin-sh`                    | `Dockerfile` and shell scripts |
| `prettier-plugin-sort-json`             | JSON key sorting               |
| `prettier-plugin-sql`                   | `.sql` files                   |
| `prettier-plugin-toml`                  | `.toml` files                  |

Plugins are auto-loaded on every invocation — no `--plugin` flags needed.

## Auto-Updates

Renovate bot automatically updates Prettier and all plugins to the latest versions.
