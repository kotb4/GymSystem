export const appConfig = {
  name: "GymPro",
  storagePrefix: "gympro",
  pageSize: 8,
} as const;

export const storageKey = (key: string) => `${appConfig.storagePrefix}.${key}`;
