export interface PermissionCatalogItem {
  key: string;
  group: string;
  label: string;
}

export interface RoleWithPermissions {
  id: number;
  name: string;
  description: string;
  permissions: string[];
}
