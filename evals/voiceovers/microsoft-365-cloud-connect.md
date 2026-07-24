# microsoft-365-cloud-connect — Members can safely search their own Microsoft 365 work data from iPolloWork Cloud

This first release is delegated, read-only access for organizational Microsoft accounts: Outlook mail, calendar, and OneDrive. Writes, Teams, app-only administration, and personal Microsoft accounts remain follow-up work.

1. I open Connections and choose Microsoft 365. iPolloWork guides me through the Entra app setup and lets me enable only read access for Outlook mail, calendar, and OneDrive.

2. A teammate opens Your Connections and connects their own work account. The row shows the Microsoft tenant, connected identity, and the exact capabilities they approved.

3. I ask iPolloWork to summarize my three latest emails. It returns concise summaries with links to the original Outlook messages, without importing my entire mailbox.

4. Next I ask for my upcoming meetings and the Q3 plan in OneDrive. iPolloWork shows the next calendar events, finds the file, and returns its source link and content.

5. I disconnect Microsoft 365 and ask the same question again. iPolloWork reports that my account needs to be connected instead of silently using another person's credentials.
