// Guest reviews for the landing page's slideshow, copied by hand from the
// café's Google Maps listing (chosen by the café; no Google API involved).
// To add one, append an entry: the text exactly as the guest wrote it, and the
// Food / Service / Atmosphere scores when the review gives them.

export interface GuestReview {
  author: string;
  /** Google's "Local Guide" badge. */
  localGuide?: boolean;
  text: string;
  scores?: { food: number; service: number; atmosphere: number };
}

export const GUEST_REVIEWS: GuestReview[] = [
  {
    author: 'A&eel',
    text:
      'the place is super nice, i definitely recommend going there with your friends and family. The staff speak both Arabic & English and are extremely nice especially Mr Majid.\n' +
      'We went on a Sunday at 10:30 pm, and it wasn’t crowded at all. i also recommend booking through their website instead of walking in.',
    scores: { food: 5, service: 5, atmosphere: 5 },
  },
  {
    author: 'Rakan Alshammari',
    localGuide: true,
    text:
      'Rating: 8/10\n' +
      'A truly sophisticated experience at Cozy Den. The atmosphere is top-notch, offering a perfect blend of comfort and charm. We thoroughly enjoyed the food; the chicken and beef burgers, along with the air-fried popcorn chicken and fries, were delicious. The Mojito was the highlight of the night—it felt like a nostalgic trip back to our days in the USA.\n' +
      'The only slight drawback was the guidance for the board games. We spent about 30 minutes reading the rules ourselves because the Game Masters weren’t familiar with the mechanics of the game we chose. This took a bit away from the overall flow of the evening.\n' +
      'I would have loved to give a full 10/10, but because of the game setup delay, it’s a solid 8/10. Definitely a place worth visiting for the vibes and the menu!',
    scores: { food: 4, service: 4, atmosphere: 5 },
  },
  {
    author: 'Aya Kira (Azuraito)',
    localGuide: true,
    text:
      'Best of the best experiences everyone should at least try once. I went there with my friends and we decided to become regular. The atmospheres is amazing and refreshing and the vibes alone are very positive and the place is full of laughter. I recommend going there and give it a try, the only thing I wish is for more addition to snacks that people can eat [ there are chips, cookies, bakeries ] sandwiches would be nice',
    scores: { food: 4, service: 5, atmosphere: 5 },
  },
  {
    author: 'Saqer Al-ghamdi',
    text:
      '10/10 everything the mood of the place the staff evertthing 10/10 I really really recommend it for anyone who love board games or want to try it 10/10 love it will visit again 100%\n' +
      'And special thanks for wael great attitude',
    scores: { food: 5, service: 5, atmosphere: 5 },
  },
  {
    author: 'Maria Erica',
    localGuide: true,
    text:
      'Great activity with friends, love the tables, it gives genuine experience. The game masters are nice and helpful! Especially Hussain, he’s very passionate and cute! The fries was quite salty but the donuts are nice. I love the whole experience, i hope you much nearby!',
    scores: { food: 4, service: 5, atmosphere: 5 },
  },
  {
    author: 'Pink bubblegum',
    text:
      'The atmosphere is so nice and there are alot of board games it was really enjoyable! We didn’t book in advance and still found a seating on Saturday evening (some days are very busy so make sure to book)',
    scores: { food: 5, service: 5, atmosphere: 5 },
  },
];
