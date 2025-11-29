import { HistoryItem } from '../types';

// Helper to resize image for thumbnail storage
export const createThumbnail = async (base64Image: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    // Ensure data URI prefix exists for loading
    img.src = base64Image.startsWith('data:') ? base64Image : `data:image/jpeg;base64,${base64Image}`;
    
    img.onload = () => {
      // Increased to 500px for better resolution on high-DPI screens
      const MAX_WIDTH = 500; 
      const scale = MAX_WIDTH / img.width;
      
      if (scale >= 1) {
        // Image is already small enough, just return stripped base64
        resolve(base64Image.replace(/^data:image\/\w+;base64,/, "")); 
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = MAX_WIDTH;
      canvas.height = img.height * scale;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(base64Image.replace(/^data:image\/\w+;base64,/, ""));
        return;
      }
      
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Quality 0.7 for better visual fidelity while managing storage size
      const resized = canvas.toDataURL('image/jpeg', 0.7); 
      resolve(resized.split(',')[1]);
    };
    
    img.onerror = () => {
       // Fallback to original if loading fails
       resolve(base64Image.replace(/^data:image\/\w+;base64,/, ""));
    };
  });
};

export const saveHistoryItem = (email: string, item: HistoryItem) => {
  try {
    const key = `snaptour_history_${email}`;
    const existingStr = localStorage.getItem(key);
    let items: HistoryItem[] = existingStr ? JSON.parse(existingStr) : [];
    
    // Add to beginning
    items.unshift(item);
    
    // Limit count to prevent list growing indefinitely
    if (items.length > 50) {
      items = items.slice(0, 50);
    }
    
    const saveToStorage = (data: HistoryItem[]) => {
      localStorage.setItem(key, JSON.stringify(data));
    };

    try {
      saveToStorage(items);
    } catch (e: any) {
      // Handle QuotaExceededError
      if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
        console.warn("Storage quota exceeded, trimming history...");
        
        // Aggressively trim until it fits or we run out of items
        while (items.length > 1) {
          items.pop(); // Remove oldest
          try {
             saveToStorage(items);
             return; // Success
          } catch (retryErr) {
             // Continue loop
          }
        }
      } else {
        throw e;
      }
    }
  } catch (e) {
    console.error("Failed to save history item", e);
  }
};

export const getHistory = (email: string): HistoryItem[] => {
  try {
    const key = `snaptour_history_${email}`;
    const existingStr = localStorage.getItem(key);
    return existingStr ? JSON.parse(existingStr) : [];
  } catch (e) {
    console.error("Failed to load history", e);
    return [];
  }
};

export const clearHistory = (email: string) => {
  localStorage.removeItem(`snaptour_history_${email}`);
};