import { cn } from "@/lib/utils";
// 产品 Logo：无白底矢量，适配深/浅主题顶栏与空态
import logoSvg from "@/assets/images/ipannel-logo.svg";

interface AppLogoProps {
  className?: string;
  /** 外层尺寸类，默认 h-7 w-7 */
  sizeClassName?: string;
  alt?: string;
}

export function AppLogo({
  className,
  sizeClassName = "h-7 w-7",
  alt = "iPannel",
}: AppLogoProps) {
  return (
    <img
      src={logoSvg}
      alt={alt}
      draggable={false}
      className={cn("shrink-0 object-contain", sizeClassName, className)}
    />
  );
}
