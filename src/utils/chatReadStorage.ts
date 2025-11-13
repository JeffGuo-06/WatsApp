import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_PREFIX = "chat:last-read:";

const buildKey = (chatId: string) => `${STORAGE_PREFIX}${chatId}`;

export const chatReadStorage = {
  getLastReadAt: async (chatId: string): Promise<string | null> => {
    try {
      return await AsyncStorage.getItem(buildKey(chatId));
    } catch (error) {
      console.error("Failed to load last-read timestamp", { chatId, error });
      return null;
    }
  },
  setLastReadAt: async (chatId: string, timestamp: string) => {
    try {
      await AsyncStorage.setItem(buildKey(chatId), timestamp);
    } catch (error) {
      console.error("Failed to persist last-read timestamp", { chatId, error });
    }
  },
  clearLastReadAt: async (chatId: string) => {
    try {
      await AsyncStorage.removeItem(buildKey(chatId));
    } catch (error) {
      console.error("Failed to clear last-read timestamp", { chatId, error });
    }
  },
};

