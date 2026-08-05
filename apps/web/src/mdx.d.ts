declare module "*.mdx" {
  import type { ComponentType } from "react";

  export const frontmatter: {
    title: string;
    description?: string;
    category?: string;
    updated_at: string;
    hero_image: string;
  };
  const Content: ComponentType<{
    components?: Record<string, ComponentType<any>>;
  }>;
  export default Content;
}
