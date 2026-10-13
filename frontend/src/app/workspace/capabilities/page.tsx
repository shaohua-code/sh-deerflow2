import { Suspense } from "react";

import {
  CapabilityCenter,
  CapabilityCenterLoading,
} from "@/components/workspace/capabilities/capability-center";

export default function CapabilitiesPage() {
  // useSearchParams 会在静态首屏进入 Suspense；保留完整页面骨架，避免能力中心闪成空白。
  return (
    <Suspense fallback={<CapabilityCenterLoading />}>
      <CapabilityCenter />
    </Suspense>
  );
}
