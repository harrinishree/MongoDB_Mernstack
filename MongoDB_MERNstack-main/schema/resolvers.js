import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { GraphQLError } from "graphql";
import auth from "../middleware/auth.js";
// Mongoose Models
import PostMessage from "../models/PostMessage.js";
import User from "../models/User.js";

export const resolvers = {
  Date: {
    name: "Date",
    description: "Date custom scalar type",
    serialize(value) {
      if (value instanceof Date) {
        return value.getTime(); // Convert outgoing Date to integer for JSON
      }
      throw Error("GraphQL Date Scalar serializer expected a `Date` object");
    },
    parseValue(value) {
      if (typeof value === "number") {
        return new Date(value); // Convert incoming integer to Date
      }
      throw new Error("GraphQL Date Scalar parser expected a `number`");
    },
    parseLiteral(ast) {
      if (ast.kind === Kind.INT) {
        // Convert hard-coded AST string to integer and then to Date
        return new Date(parseInt(ast.value, 10));
      }
      // Invalid hard-coded value (not an integer)
      return null;
    },
  },
  Query: {
    async post(_, args) {
      try {
        return await PostMessage.findById(args.id);
      } catch (error) {
        console.log(error);
        return error;
      }
    },
    async posts(_, args) {
      try {
        return await PostMessage.find()
          .sort({ _id: -1 })
          .limit(args.limit)
          .skip(args.offset);
      } catch (error) {
        console.log(error);
        return error;
      }
    },
    async user(_, args) {
      try {
        return await User.findOne({ email: args.email });
      } catch (error) {
        console.log(error);
        return error;
      }
    },
    async getPostBySearch(_, args) {
      try {
        if (args.userId) {
          return await PostMessage.find({ creator: args.userId })
            .sort({ _id: -1 })
            .limit(args.limit)
            .skip(args.offset);
        }
        if (args.search === "none" && args.tags[0] === "") {
          return await PostMessage.find()
            .sort({ _id: -1 })
            .limit(args.limit)
            .skip(args.offset);
        }
        const searchQuery = args.search;
        const tagsQuery = args.tags[0] ? args.tags[0].split(",") : [];
        let title;

        if (searchQuery !== "none") {
          title = new RegExp(searchQuery, "i"); // 'i' means ignore case aka lowercase or upper
        } else {
          title = "";
        }
        const posts = await PostMessage.find({
          $or: [{ title }, { tags: { $in: tagsQuery } }], // This says find a match with either title OR tags.
          // Since tags is an array, the $in says find any matching tags that are IN the tags array from query
        })
          .sort({ _id: -1 })
          .limit(args.limit)
          .skip(args.offset);

        return posts;
      } catch (error) {
        console.log(error);
        return error;
      }
    },
    async signIn(_, args) {
      try {
        const userExist = await User.findOne({
          email: args.email.toLowerCase(),
        });

        if (!userExist) {
          throw new GraphQLError("User does not exist", {
            extensions: { code: "USER_DOES_NOT_EXIST" },
          });
        }

        const isPasswordCorrect = await bcrypt.compare(
          args.password,
          userExist.password
        );

        if (!isPasswordCorrect) {
          throw new GraphQLError("Invalid Credentials", {
            extensions: { code: "INVALID_CREDENTIALS" },
          });
        }

        const token = jwt.sign(
          {
            email: userExist.email,
            id: userExist._id,
            name: userExist.name,
            pfp: userExist.pfp,
          },
          "test",
          { expiresIn: "1h" }
        );

        return { user: userExist, token: token };
      } catch (error) {
        console.log(error);
        return error;
      }
    },
  },
  Mutation: {
    async createPosts(_, args) {
      try {
        return await Promise.all(
          args.posts.map(async (post) => {
            const p = new PostMessage({
              title: post.title,
              message: post.message,
              name: post.name,
              creator: "Admin",
              tags: post.tags,
              selectedFile: post.selectedFile,
              createdAt: new Date().toISOString(),
            });

            return await p.save();
          })
        );
      } catch (error) {
        console.log(error);
        return error;
      }
    },
    async createPost(_, args, contextValue) {
      if (!contextValue.token || contextValue.token === "null") {
        throw new GraphQLError("Please login in order to create your post", {
          extensions: { code: "USER_NOT_LOGGED_IN" },
        });
      }
      try {
        const userId = auth(contextValue?.token);

        const post = new PostMessage({
          title: args.title,
          message: args.message,
          name: args.name,
          creator: userId,
          tags: args.tags,
          selectedFile: args.selectedFile,
          createdAt: new Date().toISOString(),
        });

        return await post.save();
      } catch (error) {
        console.log(error);
        return error;
      }
    },
    async updatePost(_, args) {
      try {
        return await PostMessage.findByIdAndUpdate(
          args.id,
          {
            $set: {
              title: args.title,
              message: args.message,
              name: args.name,
              tags: args.tags,
              selectedFile: args.selectedFile,
            },
          },
          { new: true }
        );
      } catch (error) {
        console.log(error);
        return error;
      }
    },
    async deletePost(_, args, contextValue) {
      if (
        !contextValue.token ||
        contextValue.token === "null" ||
        auth(contextValue?.token) === "error"
      ) {
        throw new GraphQLError("Please login in order to delete your post", {
          extensions: { code: "USER_NOT_LOGGED_IN" },
        });
      }
      try {
        return await PostMessage.findByIdAndDelete(args.id);
      } catch (error) {
        console.log(error);
        return error;
      }
    },
    async likePost(_, args, contextValue) {
      if (!contextValue.token || contextValue.token === "null") {
        throw new GraphQLError("Please login in order to like a post", {
          extensions: { code: "USER_NOT_LOGGED_IN" },
        });
      }
      const userId = auth(contextValue?.token);
      if (userId === "error") {
        throw new GraphQLError("Please login in order to like a post", {
          extensions: { code: "USER_NOT_LOGGED_IN" },
        });
      }
      try {
        const post = await PostMessage.findById(args.id);

        const index = post.likes.findIndex((id) => id === String(userId));

        if (index === -1) {
          post.likes.push(userId);
        } else {
          post.likes = post.likes.filter((id) => id !== String(userId));
        }
        return await PostMessage.findByIdAndUpdate(args.id, post, {
          new: true,
        });
      } catch (error) {
        console.log(error);
        return error;
      }
    },

    async commentPost(_, args, contextValue) {
      if (!contextValue.token || contextValue.token === "null") {
        throw new GraphQLError("Please login in order to like a post", {
          extensions: { code: "USER_NOT_LOGGED_IN" },
        });
      }
      const userId = auth(contextValue?.token);
      if (userId === "error") {
        throw new GraphQLError("Please login in order to like a post", {
          extensions: { code: "USER_NOT_LOGGED_IN" },
        });
      }
      try {
        const post = await PostMessage.findById(args.id);

        post.comments.push(args.value);

        const updatedPost = await PostMessage.findByIdAndUpdate(args.id, post, {
          new: true,
        });

        return updatedPost;
      } catch (error) {
        console.log(error);
        return error;
      }
    },

    async signUpGoogle(_, args) {
      try {
        const userExist = await User.findOne({
          email: args.email.toLowerCase(),
        });

        if (!userExist) {
          const newUser = await User.create({
            name: args.name,
            email: args.email.toLowerCase(),
            pfp: args.pfp,
          });

          const token = jwt.sign(
            {
              email: newUser.email,
              id: newUser._id,
              name: newUser.name,
              pfp: newUser.pfp,
            },
            "test",
            {
              expiresIn: "1h",
            }
          );
          return { user: newUser, token: token };
        } else if (userExist.hasOwnProperty("password")) {
          throw new GraphQLError(
            "User already exists, Please use your Login Credentials",
            {
              extensions: { code: "USER_ALREADY_EXISTS" },
            }
          );
        } else {
          const token = jwt.sign(
            {
              email: userExist.email,
              id: userExist._id,
              name: userExist.name,
              pfp: userExist.pfp,
            },
            "test",
            {
              expiresIn: "1h",
            }
          );

          return { user: userExist, token: token };
        }
      } catch (error) {
        console.log(error);
        return error;
      }
    },
    async signUp(_, args) {
      try {
        const userExist = await User.findOne({
          email: args.email.toLowerCase(),
        });

        if (userExist) {
          throw new GraphQLError("User already exists", {
            extensions: { code: "USER_ALREADY_EXISTS" },
          });
        }

        if (args.password !== args.confirmPassword) {
          throw new GraphQLError("Passwords do not match", {
            extensions: { code: "PASSWORDS_DO_NOT_MATCH" },
          });
        }

        const hashPassword = await bcrypt.hash(args.password, 12);

        const result = await User.create({
          name: `${args.firstName} ${args.lastName}`,
          email: args.email.toLowerCase(),
          password: hashPassword,
        });

        const token = jwt.sign(
          {
            email: result.email,
            id: result._id,
            name: result.name,
            pfp: result.pfp,
          },
          "test",
          {
            expiresIn: "1h",
          }
        );

        return { user: result, token: token };
      } catch (error) {
        console.log(error);
        return error;
      }
    },
  },
};
