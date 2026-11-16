# Dependency and application storage maintenance

The iPolloWork-owned runtime, suite and cloud-image manifests override Undici 8 to 8.12.4, MCP client to 2.4.0 and fflate to 0.8.3. The suite's direct Undici 7 dependency is 7.30.2. Desktop packaging applies the same transitive versions. Publisher overrides UUID below 11.1.1 to 11.1.1. Official DSH source remains unchanged. Run `npm run audit:dependencies` to audit the four owned lockfiles; CI runs the same gate. This gate measures published dependency advisories, not all possible source vulnerabilities or container OS packages.

Service and sandbox image defaults use Node 24.22.3. Existing installed official clients need an updated dependency installation or a newly built iPolloWork package; changing this repository does not silently patch them.

Application records reject inline data URLs, temporary blob URLs, common image encodings and Node Buffer JSON. Files use the existing private object store, with metadata in schema 11. Local fixture tests use disk and mocked OSS transfers; live OSS, container scans and cloud configuration still require deployment validation. See the [application-data documentation](../services/ipollowork/docs/app-data.md).
