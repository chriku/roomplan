import fs from "node:fs";

export class User {
    static readonly users: User[] = (JSON.parse(fs.readFileSync("users.json", "utf8")) as string[]).map((name) => new User(name));
    static findUser(name: string): User | null {
        const matchingUsers = this.users.filter((it) => it.name == name);
        if (matchingUsers.length > 0)
            return matchingUsers[0];
        else return null;
    }
    constructor(readonly name: string) { }
}