// Apify SDK - toolkit for building Apify Actors (Read more at https://docs.apify.com/sdk/js/)
import { Actor } from 'apify';

// The init() call configures the Actor to correctly work with the Apify-provided environment -
// mainly the storage infrastructure. It is necessary that every Actor performs an init() call.
await Actor.init();

// Structure of input will be defined in .actor/input_schema.json once the profile form is built.
const input = await Actor.getInput();
console.log('WorkDey Match Agent starting with input:', input);

// Gracefully exit the Actor process. It's recommended to quit all Actors with an exit()
await Actor.exit();
