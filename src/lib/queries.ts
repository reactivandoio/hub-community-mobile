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

export const EVENT_SIGNUP_FIELDS = gql`
  fragment EventSignupFields on EventSignup {
    id
    name
    email
    phone_number
    checked_in
    checked_in_at
    product_name
  }
`;

export const EVENT_SIGNUPS = gql`
  query EventSignups($eventSlug: String!) {
    eventSignups(eventSlug: $eventSlug) {
      ...EventSignupFields
    }
  }
  ${EVENT_SIGNUP_FIELDS}
`;

export const CHECKIN_SIGNUP = gql`
  mutation CheckinSignup($eventSlug: String!, $signupId: String!, $checkedInAt: String) {
    checkinSignup(eventSlug: $eventSlug, signupId: $signupId, checkedInAt: $checkedInAt) {
      success
      message
      signup {
        ...EventSignupFields
      }
    }
  }
  ${EVENT_SIGNUP_FIELDS}
`;

export const MANUAL_SIGNUP = gql`
  mutation ManualSignup($eventSlug: String!, $batchId: String!, $input: ManualSignupInput!) {
    manualSignup(eventSlug: $eventSlug, batchId: $batchId, input: $input) {
      success
      message
      account_created
      signup {
        ...EventSignupFields
      }
    }
  }
  ${EVENT_SIGNUP_FIELDS}
`;

export const EVENT_BATCHES = gql`
  query EventBatches($slugOrId: String!) {
    eventBySlugOrId(slugOrId: $slugOrId) {
      id
      title
      products {
        id
        name
        enabled
        batches {
          id
          batch_number
          value
          enabled
        }
      }
    }
  }
`;
