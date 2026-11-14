---
kind: upgrade-guide
description: iPolloWork suite 0.1.10 requires the updated DSH Connection and YAML APIs.
---

# iPolloWork desktop account

English | [中文](guide.zh.md)

## Change

The dedicated iPolloWork desktop includes suite 0.1.10 and requires DSH 0.2.2-rc.3 or later in the 0.2.2 release line. The suite uses the current Connection admission and YAML parsing APIs. Earlier DSH runtimes cannot load this suite version. The native welcome page retains its existing flow and provides iPolloWork email/password sign-in and registration.

Account channels display the backend channel name. Without a configured personal API key, the desktop selects an available account channel. Personal API-key providers remain selectable; insufficient account points are reported separately from key failures.

The suite also updates IM context access and carries Design/Video `1.0.0-beta.19.ipollo.1` with the required editor authentication dependency. Existing Studio documents and channel credentials retain their formats.

## Migration

1. Use the bundled iPolloWork desktop runtime when installing suite 0.1.10, or update an existing DSH runtime to a compatible version first.
2. Open the desktop application and select **Sign in**, then sign in or create an account. Registration requires a display name, email and password of at least 10 characters.
3. Update an existing Design or Video installation to the bundled `1.0.0-beta.19.ipollo.1` release from the iPolloWork market.
4. Confirm that the iPolloWork account and main-assistant entries appear. The dedicated desktop keeps the suite enabled; existing sessions and account records require no format conversion.
