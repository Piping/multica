import type { ComponentPropsWithoutRef } from "react";
import { Link as RouterLink } from "react-router-dom";

type Props = Omit<ComponentPropsWithoutRef<"a">, "href"> & {
  href: string;
};

export default function Link({ href, ...props }: Props) {
  if (/^(?:[a-z]+:)?\/\//i.test(href) || href.startsWith("mailto:")) {
    return <a href={href} {...props} />;
  }
  return <RouterLink to={href} {...props} />;
}
