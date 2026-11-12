const AVATAR_PRESETS = [
  { id: 'FOX', label: 'Fox' },
  { id: 'PANDA', label: 'Panda' },
  { id: 'LION', label: 'Lion' },
  { id: 'ROBOT', label: 'Robot' },
  { id: 'ALIEN', label: 'Alien' },
  { id: 'CAT', label: 'Cat' },
  { id: 'DOG', label: 'Dog' },
  { id: 'UNICORN', label: 'Unicorn' },
];

const AVATAR_COLORS = [
  { id: '#EF4444', label: 'Red' },
  { id: '#F97316', label: 'Orange' },
  { id: '#EAB308', label: 'Yellow' },
  { id: '#22C55E', label: 'Green' },
  { id: '#06B6D4', label: 'Cyan' },
  { id: '#3B82F6', label: 'Blue' },
  { id: '#8B5CF6', label: 'Purple' },
  { id: '#EC4899', label: 'Pink' },
];

const AVATAR_PRESET_IDS = AVATAR_PRESETS.map((preset) => preset.id);
const AVATAR_COLOR_IDS = AVATAR_COLORS.map((color) => color.id);

const DEFAULT_AVATAR = {
  preset: 'FOX',
  color: '#3B82F6',
};

module.exports = {
  AVATAR_PRESETS,
  AVATAR_COLORS,
  AVATAR_PRESET_IDS,
  AVATAR_COLOR_IDS,
  DEFAULT_AVATAR,
};
