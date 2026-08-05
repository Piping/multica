import type { CSSProperties, ImgHTMLAttributes } from "react";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
};

export default function Image({
  fill,
  priority,
  quality: _quality,
  style,
  ...props
}: Props) {
  const fillStyle: CSSProperties | undefined = fill
    ? {
        ...style,
        position: "absolute",
        inset: 0,
        height: "100%",
        width: "100%",
      }
    : style;

  return (
    <img
      {...props}
      style={fillStyle}
      loading={priority ? "eager" : props.loading}
      fetchPriority={priority ? "high" : props.fetchPriority}
    />
  );
}
