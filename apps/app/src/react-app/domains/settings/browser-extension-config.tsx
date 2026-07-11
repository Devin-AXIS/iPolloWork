/** @jsxImportSource react */
import { MonitorSmartphone } from "lucide-react";

import { surfaceCardClass } from "../workspace/modal-styles";
import { registerExtensionConfig } from "./extension-registry";

const IPolloWalkBrowserConfigFactory = () => <IPolloWalkBrowserConfig />;

registerExtensionConfig("ipollowalk.browser.settings", IPolloWalkBrowserConfigFactory);
registerExtensionConfig("ipollowalk-browser", IPolloWalkBrowserConfigFactory);

function IPolloWalkBrowserConfig() {
  return (
    <div className={`${surfaceCardClass} space-y-3 p-4`}>
      <div className="flex items-start gap-3">
        <MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-blue-11" />
        <div className="space-y-1 text-[13px] leading-relaxed text-dls-secondary">
          <div className="font-medium text-dls-text">Ready by default</div>
          <div>The iPolloWalk Browser runs inside the app, opens visibly for browser tasks, and is the supported browser automation path in iPolloWalk.</div>
        </div>
      </div>
    </div>
  );
}
