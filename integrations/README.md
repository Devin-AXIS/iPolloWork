# iPolloWork DSH integration

English | [中文](README.zh.md)

The `dsh` branch contains the upstream DSH runtime, the iPolloOS enterprise connector, the iPolloWork suite and its independent account service. Each application keeps its own dependencies, tests and deployment lifecycle.

| Location | Included capability |
| --- | --- |
| `plugins/ipollo-enterprise` | Join an existing iPolloOS enterprise |
| `plugins/ipollowork-suite` | Theme, marketplace, agents, coordinator, IM, project collaboration, native session sharing and service connections |
| `plugins/ipollowork-suite/catalog/packages` | Current self-contained Design/PPT and Video packages |
| `services/ipollowork` | Accounts, membership, points, service execution, project grants, changes and native sharing relay |

Install and build the suite from its directory using its README, then install it through the native `dsh plugin` command. Deploy the account service separately and set the suite's `accountOrigin` to that deployment. DSH remains the application launcher and execution runtime. Existing upstream files and session formats are unchanged.

`ipollowork.json` records the included source revisions and source-file hashes. It omits generated build directories, credentials, local sessions and superseded plugin archives. The Design/Video source remains in its independent repository, recorded in that file; the catalog includes its complete current installable packages.

The iPolloWork integrations workflow checks the enterprise connector, suite and account service independently. Runtime compatibility and native integration checks remain described by the owning READMEs. Package license declarations and third-party notices remain authoritative for their respective directories.

The suite's embedded IM sources retain their upstream wording and notices under `plugins/ipollowork-suite/vendor/dsh-im`. The repository's concrete-terms check excludes that exact vendor directory; suite-owned code remains checked.
