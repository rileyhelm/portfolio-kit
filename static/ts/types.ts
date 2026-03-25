export type BlockType = 'text' | 'image' | 'divider';
export type Align = 'left' | 'center' | 'right';
export type TextPreviewMode = 'split' | 'edit' | 'preview';

interface BaseBlock {
  id: string;
  type: BlockType;
}

export interface TextBlock extends BaseBlock {
  type: 'text';
  markdown: string;
  previewMode?: TextPreviewMode;
  previewHtml?: string;
}

export interface ImageBlock extends BaseBlock {
  type: 'image';
  src: string;
  alt: string;
  caption: string;
  align: Align;
  width: number;
}

export interface DividerBlock extends BaseBlock {
  type: 'divider';
}

export type Block = TextBlock | ImageBlock | DividerBlock;

export interface ProjectPayload {
  slug: string;
  name: string;
  date: string;
  draft: boolean;
  pinned: boolean;
  thumbnail: string | null;
  youtube: string | null;
  og_image: string | null;
  markdown: string;
  html: string;
  revision: string | null;
}

export interface SiteSettingsPayload {
  site_name: string;
  owner_name: string;
  tagline: string;
  about_photo: string | null;
  contact_email: string | null;
  social_links: Array<{
    label: string;
    url: string;
  }>;
}

export interface AboutPayload {
  markdown: string;
  html: string;
  revision: string | null;
  settings_revision: string | null;
  settings: SiteSettingsPayload;
}
