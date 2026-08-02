# iPolloWork Package Format

Status: Draft specification 1.0  
Canonical extension: `.ipwp`  
Legacy template extension: `.ipwt`  
Canonical media type: `application/vnd.ipollowork.package+zip`

## 1. Scope

The iPolloWork Package Format is a portable container for an iPolloWork artifact and its editable resources. The first profile is the existing template manifest with `schemaVersion: 1`; it covers design, slide, web, App prototype, report, poster, article, card, and HyperFrames video templates.

This specification separates the package container from future manifest profiles. A new filename does not rewrite an existing template, design system, package identifier, version, or session snapshot.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are interpreted as described by [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## 2. Compatibility contract

Conforming iPolloWork readers:

- MUST accept the canonical `.ipwp` extension;
- MUST continue to accept the legacy `.ipwt` extension for every valid template manifest with `schemaVersion: 1`;
- MUST validate the archive contents rather than trust the extension or media type;
- MUST NOT rewrite an imported archive, its manifest, or its embedded design-system files merely because it uses the legacy extension;
- MUST preserve installed template and materialized session behavior when the package filename changes;
- MUST reject unsupported required schema versions explicitly instead of interpreting them as an older schema;
- MAY restrict execution of historical active content for security reasons, but SHOULD still allow safe metadata and static content recovery.

Conforming writers SHOULD use `.ipwp` and the canonical media type. A writer that deliberately targets an older iPolloWork release MAY emit the byte-identical `.ipwt` alias when the package only uses the v1 template profile.

## 3. Container

An `.ipwp` package is a ZIP archive with these constraints:

- `manifest.json` MUST be present at the archive root;
- archive paths MUST be relative and MUST NOT contain `..` traversal;
- symbolic links, executable files, duplicate paths, and absolute paths MUST be rejected;
- the archive MUST contain at most 1,000 files;
- the compressed archive MUST be at most 50 MB;
- expanded content MUST be at most 200 MB;
- an individual file MUST be at most 25 MB.

The current static-file allowlist and the exact template profile are defined by the reference implementation in `packages/types/src/templates.ts` and `apps/server/src/templates.ts`.

## 4. Template manifest profile v1

The v1 profile is identified by:

```json
{
  "schemaVersion": 1,
  "kind": "design"
}
```

`schemaVersion` describes the manifest contract. `version` describes the packaged artifact and follows semantic versioning. `minimumAppVersion` describes the minimum compatible iPolloWork release. These values are independent and MUST NOT be substituted for one another.

The v1 schema is strict. Producers MUST NOT add undeclared top-level fields. Future package capabilities or extension namespaces require a new manifest schema version and a published migration rule.

`designSystem` is part of the artifact's public editing contract. A reader MUST preserve its token file, editable groups, variables, and referenced asset paths when importing or materializing the package.

## 5. Media types and filename handling

The canonical media type is:

```text
application/vnd.ipollowork.package+zip
```

The legacy media type remains accepted:

```text
application/vnd.ipollowork-template+zip
```

Media types and filename extensions are discovery hints. ZIP integrity, path safety, `manifest.json`, schema validation, required files, and surface-specific rules are authoritative.

## 6. Lossless legacy migration

Migrating an unpublished v1 template from `.ipwt` to `.ipwp` consists only of copying or renaming the file. Its bytes, `id`, `version`, source attribution, license, design tokens, and assets remain unchanged.

Published package versions are immutable. If package contents change, the producer MUST publish a new semantic version rather than replace the bytes associated with an existing `id` and `version`.

## 7. Version evolution

Every stable manifest schema accepted by a released iPolloWork reader becomes part of the backward-compatibility suite. A future reader MUST retain parsers or deterministic migrations for all earlier stable schemas.

A future schema MAY add package kinds, capabilities, permissions, integrity metadata, output declarations, or namespaced extensions. Such additions MUST define:

- whether each field is required or optional;
- behavior for unknown optional fields;
- behavior for unknown required capabilities;
- a deterministic migration from earlier schemas where one is possible;
- security and privacy consequences;
- conformance fixtures for valid, invalid, and malicious packages.

## 8. Security and provenance

Readers MUST enforce archive size and path limits before installation. They MUST validate declared entries, covers, token files, video variables, slide structure, and editable PowerPoint markers before materialization.

Packages MUST declare their source and license. Renaming an archive or migrating its container does not remove upstream attribution or license obligations.

## 9. Conformance artifacts

The iPolloWork repository is the reference implementation. A stable public release of this specification should include:

- a machine-readable JSON Schema;
- byte-stable valid v1 fixtures under both extensions;
- invalid and malicious archive fixtures;
- a validator and deterministic pack command;
- a compatibility matrix covering every stable schema;
- an open change and governance process suitable for independent implementations.

A whitepaper may describe the problem, ecosystem, and adoption model, but conformance is determined by this technical contract and its test suite.
