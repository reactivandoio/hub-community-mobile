// All GraphQL operations live here (same convention as the web frontend).
import { gql } from '@apollo/client';

export const EVENTS = gql`
  query Events($sort: [EventSort]) {
    events(sort: $sort) {
      data {
        id
        documentId
        slug
        title
        start_date
        location {
          title
          city
        }
      }
    }
  }
`;
