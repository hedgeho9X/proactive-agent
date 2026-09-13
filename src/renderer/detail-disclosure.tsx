/** 将非核心详情延迟挂载到可访问的折叠面板，默认只显示入口。 */
import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

/** 展开后才渲染内容，避免隐藏的证据面板继续发起请求。 */
export function DetailDisclosure({
  title,
  children,
  open: controlled,
  onOpenChange,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [local, setLocal] = useState(false);
  const open = controlled ?? local;
  return (
    <Collapsible
      open={open}
      onOpenChange={(value) => {
        setLocal(value);
        onOpenChange?.(value);
      }}
    >
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <ChevronRight
            data-icon="inline-start"
            className={open ? "rotate-90" : undefined}
          />
          {title}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{open && children}</CollapsibleContent>
    </Collapsible>
  );
}
