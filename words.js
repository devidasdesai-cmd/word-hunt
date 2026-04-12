const WORDS = [
  "Africa", "Agent", "Air", "Alien", "Alps", "Amazon", "Ambulance", "America", "Angel", "Antarctica",
  "Apple", "Arm", "Atlantis", "Australia", "Aztec", "Back", "Ball", "Band", "Bank", "Bar",
  "Bark", "Bat", "Battery", "Beach", "Bear", "Beat", "Bed", "Bell", "Berry", "Bill",
  "Block", "Board", "Bolt", "Bond", "Book", "Boom", "Boot", "Bottle", "Bow", "Box",
  "Bridge", "Brush", "Buck", "Bug", "Burn", "Butt", "Cabin", "Camp", "Can", "Capital",
  "Car", "Card", "Carrot", "Casino", "Cast", "Cat", "Cell", "Chair", "Change", "Check",
  "Chess", "Chest", "Chick", "China", "Chip", "Chocolate", "Church", "Circle", "Cliff", "Clock",
  "Club", "Clue", "Coast", "Coat", "Code", "Cold", "Comic", "Computer", "Contract", "Cook",
  "Copper", "Cotton", "Court", "Cover", "Crane", "Creek", "Cricket", "Cross", "Crown", "Cycle",
  "Dance", "Date", "Day", "Death", "Deck", "Degree", "Delta", "Diamond", "Die", "Dinosaur",
  "Disease", "Doctor", "Dog", "Draft", "Dragon", "Dream", "Dress", "Drill", "Drop", "Duck",
  "Dump", "Eagle", "Earth", "Egypt", "Embassy", "Engine", "Europe", "Eye", "Face", "Fan",
  "Field", "Fighter", "Figure", "Film", "Fire", "Fish", "Flag", "Fly", "Force", "Forest",
  "Fork", "Game", "Gas", "Germany", "Ghost", "Giant", "Glass", "Glove", "Gold", "Grass",
  "Greece", "Green", "Ground", "Guitar", "Gun", "Hammer", "Hand", "Head", "Heart", "Helicopter",
  "Hole", "Hook", "Horn", "Horse", "Hospital", "Hotel", "Ice", "Iron", "Island", "Italy",
  "Jack", "Jam", "Japan", "Jet", "Judge", "Jupiter", "Key", "Kid", "King", "Knife",
  "Knight", "Lab", "Lake", "Lap", "Lead", "Leaf", "Lemon", "Light", "Line", "Lion",
  "Loch", "Lock", "Log", "London", "Love", "Luck", "Lung", "Lyre", "Magic", "Marble",
  "March", "Mars", "Master", "Match", "Mercury", "Mexico", "Moon", "Mountain", "Mouse", "Mouth",
  "Nail", "Net", "Night", "Novel", "Nurse", "Nut", "Ocean", "Olive", "Opera", "Orange",
  "Organ", "Palm", "Pan", "Paper", "Paris", "Park", "Part", "Pass", "Paste", "Patch",
  "Penguin", "Phoenix", "Piano", "Pie", "Pilot", "Pin", "Pipe", "Pit", "Plane", "Plant",
  "Plastic", "Plate", "Point", "Pool", "Port", "Pound", "Press", "Prince", "Pub", "Pump",
  "Queen", "Race", "Ray", "Revolution", "Ring", "River", "Robin", "Robot", "Rock", "Rome",
  "Root", "Rose", "Round", "Row", "Rub", "Russia", "Sand", "School", "Screen", "Sea",
  "Server", "Shadow", "Ship", "Shot", "Sign", "Silver", "Slug", "Snow", "Soldier", "Sound",
  "Space", "Spell", "Spider", "Spike", "Spine", "Spring", "Square", "Staff", "Stage", "Star",
  "State", "Steam", "Steel", "Step", "Stock", "Stone", "Store", "Storm", "Straw", "Street",
  "Strike", "Sub", "Sun", "Swing", "Switch", "Table", "Tank", "Tap", "Temple", "Thumb",
  "Tick", "Tie", "Tiger", "Time", "Toast", "Tokyo", "Tower", "Train", "Trap", "Tree",
  "Trip", "Trump", "Tube", "Turkey", "Vacuum", "Van", "Vest", "Victor", "Video", "Violin",
  "Virus", "Wake", "Wall", "War", "Watch", "Wave", "Web", "Well", "Whale", "Whip",
  "Whistle", "Witch", "Wolf", "Wood", "Worm", "Yard", "Zero"
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getWords(n = 25) {
  return shuffle(WORDS).slice(0, n);
}

module.exports = { getWords };
