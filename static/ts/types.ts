export type BlockType = 'text' | 'image' | 'divider' | 'row';
export type Align = 'left' | 'center' | 'right';

interface BaseBlock {
  id: string;
  type: BlockType;
}

export interface TextBlock extends BaseBlock {
  type: 'text';
  markdown: string;
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

export type RowChildBlock = TextBlock | ImageBlock | DividerBlock;

export interface RowBlock extends BaseBlock {
  type: 'row';
  left: RowChildBlock;
  right: RowChildBlock;
}

export type Block = RowChildBlock | RowBlock;

export interface ProjectPayload {
  slug: string;
  name: string;
  date: string;
  draft: boolean;
  thumbnail: string | null;
  youtube: string | null;
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
