// utils/supabaseErrorHandler.js

function getFriendlySupabaseError(error) {
    if (!error) {
      return "An unknown error occurred.";
    }
  
    // Handle Database Errors (Postgres codes)
    if (error.code && error.code.match(/^\d/)) {
      switch (error.code) {
        case "23505":
          return "A record with the same value already exists.";
        case "23503":
          return "The related record does not exist.";
        case "23502":
          return "Missing required fields. Please fill in all fields.";
        case "23514":
          return "The data provided does not meet the required conditions.";
        case "22P02":
          return "Invalid format for submitted data.";
        case "42501":
          return "You do not have permission to perform this action.";
        case "42703":
          return "Invalid field name used in the request.";
        case "42883":
          return "An internal server error occurred. Please try again later.";
        default:
          return "An unexpected database error occurred.";
      }
    }
  
    // Handle Auth Errors (Supabase Auth)
    if (error.code) {
      switch (error.code) {
        case "invalid_signup":
          return "Unable to sign up. Please check your information.";
        case "user_not_found":
          return "No account found with this email address.";
        case "invalid_login_credentials":
          return "Incorrect email or password.";
        case "email_already_exists":
          return "An account with this email already exists.";
        case "invalid_email":
          return "Please enter a valid email address.";
        case "password_too_short":
          return "Password must be at least 6 characters long.";
        case "invalid_token":
          return "Your session has expired. Please log in again.";
        case "email_not_confirmed":
          return "Please confirm your email address first.";
        case "provider_already_linked":
          return "This account is already linked with another provider.";
        case "auth_missing_refresh_token":
        case "jwt_expired":
          return "Your session has expired. Please log in again.";
        case "unauthorized":
          return "You are not authorized to perform this action.";
        case "invalid_request":
          return "The request made is invalid.";
        case "too_many_requests":
          return "You made too many requests. Please slow down.";
        default:
          return "An unexpected authentication error occurred.";
      }
    }
  
    return "An unexpected error occurred.";
  }
  
  module.exports = { getFriendlySupabaseError };
  