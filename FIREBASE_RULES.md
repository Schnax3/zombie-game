# Firebase Realtime Database Rules

Add the following rules to your Firebase Console to enable leaderboard queries:

## Setup Instructions

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `zombie-game-leveldown`
3. Navigate to **Realtime Database** → **Rules**
4. Replace the rules with the configuration below

## Rules Configuration

```json
{
  "rules": {
    "leaderboard": {
      "walk": {
        ".indexOn": ["loot"],
        "$scoreId": {
          ".validate": "newData.hasChildren(['uid', 'email', 'loot', 'time', 'preset', 'date']) && newData.child('preset').val() === 'walk'"
        }
      },
      "jog": {
        ".indexOn": ["loot"],
        "$scoreId": {
          ".validate": "newData.hasChildren(['uid', 'email', 'loot', 'time', 'preset', 'date']) && newData.child('preset').val() === 'jog'"
        }
      },
      "bike": {
        ".indexOn": ["loot"],
        "$scoreId": {
          ".validate": "newData.hasChildren(['uid', 'email', 'loot', 'time', 'preset', 'date']) && newData.child('preset').val() === 'bike'"
        }
      }
    },
    ".read": true,
    ".write": "auth != null"
  }
}
```

## What This Does

- **`.indexOn: ["loot"]`**: Creates an index on the `loot` field for each category, allowing efficient queries when sorting by score
- **`$scoreId`**: Each score gets a unique auto-generated ID (via `push()`), not tied to user ID
- **`.validate`**: Ensures each entry has required fields AND that the `preset` field matches the category (walk scores only in walk, etc.)
- **`.read: true`**: Allows anyone to read the leaderboard
- **`.write: "auth != null"`**: Only authenticated users can write

This structure ensures that each endless run is stored separately, and a "Gehen" run only appears in the Gehen leaderboard.

After updating the rules, click **Publish** and the leaderboard queries will work.

⚠️ **IMPORTANT**: If you already have old scores in your database that were stored under the wrong category, delete them in the Firebase Console under **Realtime Database** → select the `/leaderboard` node and clear each category before publishing the new rules. This ensures clean data and prevents cross-category score pollution.

---

**Note**: Make sure your Firebase authentication is configured with Email/Password sign-in in the Firebase Console under **Authentication** → **Sign-in method**.
