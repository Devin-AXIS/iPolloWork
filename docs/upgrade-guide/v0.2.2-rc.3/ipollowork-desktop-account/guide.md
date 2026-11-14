---
kind: upgrade-guide
description: iPolloWork suite 0.1.10 requires the updated DSH Connection and YAML APIs.
---

# iPolloWork desktop account

English | [中文](guide.zh.md)

## Change

The dedicated iPolloWork desktop includes suite 0.1.10 and requires DSH 0.2.2-rc.3 or later in the 0.2.2 release line. The suite uses the current Connection admission and YAML parsing APIs. Earlier DSH runtimes cannot load this suite version. The native welcome page retains its existing flow and provides iPolloWork email/password sign-in and registration.

## Migration

1. Use the bundled iPolloWork desktop runtime when installing suite 0.1.10, or update an existing DSH runtime to a compatible version first.
2. Open the desktop application and select **Sign in**, then sign in or create an account. Registration requires a display name, email and password of at least 10 characters.
3. Confirm that the iPolloWork account and main-assistant entries appear. The dedicated desktop keeps the suite enabled; existing sessions and account records require no format conversion.
